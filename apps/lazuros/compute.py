"""Compute-node management: Wake-on-LAN + liveness for the Ollama desktop.

The container runs with network_mode: host so the WoL magic packet can be
broadcast on the LAN directly.
"""

import asyncio
import logging
import os
import socket
import time

import httpx

log = logging.getLogger("lazuros.compute")

COMPUTE_NODE_IP = os.getenv("COMPUTE_NODE_IP", "")
COMPUTE_NODE_MAC = os.getenv("COMPUTE_NODE_MAC", "")
COMPUTE_API_PORT = int(os.getenv("COMPUTE_API_PORT", "11434"))
WOL_PORT = int(os.getenv("WOL_PORT", "9"))
WOL_BROADCAST = os.getenv("WOL_BROADCAST", "255.255.255.255")

OLLAMA_BASE = f"http://{COMPUTE_NODE_IP}:{COMPUTE_API_PORT}"

# Don't re-broadcast WoL more than once per window — the widget polls /wake.
_WOL_COOLDOWN_SECONDS = 20
_last_wol_sent = 0.0


def send_wol(mac: str = COMPUTE_NODE_MAC) -> bool:
    """Broadcast a WoL magic packet. Returns False if rate-limited or unconfigured."""
    global _last_wol_sent
    if not mac:
        log.warning("COMPUTE_NODE_MAC not set — cannot send WoL")
        return False
    now = time.monotonic()
    if now - _last_wol_sent < _WOL_COOLDOWN_SECONDS:
        return False
    raw = bytes.fromhex(mac.replace(":", "").replace("-", ""))
    if len(raw) != 6:
        raise ValueError(f"bad MAC address: {mac}")
    packet = b"\xff" * 6 + raw * 16
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.sendto(packet, (WOL_BROADCAST, WOL_PORT))
    _last_wol_sent = now
    log.info("WoL magic packet sent to %s (broadcast %s:%s)", mac, WOL_BROADCAST, WOL_PORT)
    return True


async def is_online(client: httpx.AsyncClient) -> bool:
    """Quick liveness probe against Ollama — cheap enough for poll endpoints."""
    if not COMPUTE_NODE_IP:
        return False
    try:
        r = await client.get(f"{OLLAMA_BASE}/api/version", timeout=1.5)
        return r.status_code == 200
    except httpx.HTTPError:
        return False


async def ensure_awake(client: httpx.AsyncClient, timeout_seconds: int) -> bool:
    """If the node is asleep, send WoL and poll until it answers or we time out."""
    if await is_online(client):
        return True
    send_wol()
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        await asyncio.sleep(2)
        if await is_online(client):
            log.info("compute node is awake")
            return True
    log.warning("compute node did not wake within %ss", timeout_seconds)
    return False
