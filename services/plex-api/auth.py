import asyncio
from fastapi import Depends, HTTPException, Request
from jose import JWTError
from typing import Annotated

from jkos_auth import verify_token, COOKIE_NAME


async def require_user(request: Request) -> dict:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        return await asyncio.get_event_loop().run_in_executor(None, verify_token, token)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


CurrentUser = Annotated[dict, Depends(require_user)]
