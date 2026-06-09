import os
from fastapi import Depends, HTTPException, Request
from jose import jwt, JWTError
from typing import Annotated

PUBLIC_KEY = os.getenv("JKOS_AUTH_PUBLIC_KEY", "").replace("\\n", "\n")


async def require_user(request: Request) -> dict:
    token = request.cookies.get("jkos_token")
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not PUBLIC_KEY:
        raise HTTPException(status_code=500, detail="JKOS_AUTH_PUBLIC_KEY is not set")
    try:
        return jwt.decode(token, PUBLIC_KEY, algorithms=["RS256"], issuer="jkos-auth")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


CurrentUser = Annotated[dict, Depends(require_user)]
