"""Keep provider keys in macOS Keychain; never write a secret file.

python3 scripts/deepseek-keychain.py save
python3 scripts/deepseek-keychain.py check
python3 scripts/deepseek-keychain.py run <command> [args...]
python3 scripts/deepseek-keychain.py --provider fal-admin save
python3 scripts/deepseek-keychain.py --provider fal-admin check
python3 scripts/deepseek-keychain.py --provider paddle-sandbox save
python3 scripts/deepseek-keychain.py --provider paddle-sandbox check
"""
import ctypes
import getpass
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
import warnings

PROVIDER = "deepseek"
if len(sys.argv)>2 and sys.argv[1] == "--provider":
    PROVIDER = sys.argv[2]
    del sys.argv[1:3]
if PROVIDER not in ("deepseek", "fal", "fal-admin", "paddle-sandbox"):
    raise SystemExit("Provider must be deepseek, fal, fal-admin or paddle-sandbox.")
SERVICE = ("afterlight." + PROVIDER).encode()
ACCOUNT = {"deepseek": b"director", "fal": b"video", "fal-admin": b"billing", "paddle-sandbox": b"api"}[PROVIDER]


def validate_secret(secret):
    if not secret or any(ch.isspace() for ch in secret):
        raise RuntimeError("Enter a nonempty API key without whitespace.")
    if PROVIDER == "paddle-sandbox" and not re.fullmatch(
        r"pdl_sdbx_apikey_[a-z\d]{26}_[a-zA-Z\d]{22}_[a-zA-Z\d]{3}", secret
    ):
        raise RuntimeError("Expected a current Paddle Sandbox API key.")
    return secret


def keychain(save=None):
    if sys.platform != "darwin":
        raise RuntimeError("This helper requires macOS Keychain.")
    security = ctypes.CDLL("/System/Library/Frameworks/Security.framework/Security")
    core = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
    pointer = ctypes.c_void_p
    length = ctypes.c_uint32()
    data = pointer()
    item = pointer()
    find = security.SecKeychainFindGenericPassword
    find.argtypes = [pointer, ctypes.c_uint32, ctypes.c_char_p, ctypes.c_uint32, ctypes.c_char_p, ctypes.POINTER(ctypes.c_uint32), ctypes.POINTER(pointer), ctypes.POINTER(pointer)]
    find.restype = ctypes.c_int32
    code = find(None, len(SERVICE), SERVICE, len(ACCOUNT), ACCOUNT, None if save else ctypes.byref(length), None if save else ctypes.byref(data), ctypes.byref(item))
    try:
        if save is not None:
            value = save.encode()
            if code == -25300:
                add = security.SecKeychainAddGenericPassword
                add.argtypes = [pointer, ctypes.c_uint32, ctypes.c_char_p, ctypes.c_uint32, ctypes.c_char_p, ctypes.c_uint32, pointer, ctypes.POINTER(pointer)]
                code = add(None, len(SERVICE), SERVICE, len(ACCOUNT), ACCOUNT, len(value), ctypes.c_char_p(value), None)
            elif code == 0:
                update = security.SecKeychainItemModifyAttributesAndData
                update.argtypes = [pointer, pointer, ctypes.c_uint32, pointer]
                code = update(item, None, len(value), ctypes.c_char_p(value))
            if code != 0:
                raise RuntimeError(f"Keychain storage failed ({code}).")
            return None
        if code != 0:
            raise RuntimeError(f"Keychain read failed ({code}). Save this provider key first.")
        return ctypes.string_at(data, length.value).decode()
    finally:
        if data:
            security.SecKeychainItemFreeContent.argtypes = [pointer, pointer]
            security.SecKeychainItemFreeContent(None, data)
        if item:
            core.CFRelease.argtypes = [pointer]
            core.CFRelease(item)


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "check"
    if action == "save":
        # Fail closed if getpass cannot disable echo; never fall back to visible input.
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            secret = validate_secret(getpass.getpass(f"{PROVIDER} API key (hidden): ").strip())
        keychain(secret)
        print(f"{PROVIDER} key stored in macOS Keychain. No secret file created.")
    elif action == "check":
        endpoint = {
            "deepseek": "https://api.deepseek.com/user/balance",
            "fal": "https://api.fal.ai/v1/account/billing?expand=credits",
            "fal-admin": "https://api.fal.ai/v1/account/billing?expand=credits",
            "paddle-sandbox": "https://sandbox-api.paddle.com/products?per_page=1",
        }[PROVIDER]
        request = urllib.request.Request(endpoint, headers={"Authorization": ("Key " if PROVIDER in ("fal", "fal-admin") else "Bearer ") + validate_secret(keychain())})
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(request, timeout=30) as response:
                payload = json.load(response)
                if PROVIDER == "deepseek":
                    print(json.dumps({"authenticated": True, "available": payload.get("is_available"), "balances": [{"currency": b.get("currency"), "total": b.get("total_balance")} for b in payload.get("balance_infos", [])]}))
                elif PROVIDER in ("fal", "fal-admin"):
                    print(json.dumps({"billing_access":True,"credits":payload.get("credits")}))
                else:
                    print(json.dumps({"authenticated": True, "environment": "sandbox", "product_read": True}))
        except urllib.error.HTTPError as error:
            print(json.dumps({"check_failed":True,"provider":PROVIDER,"http_status":error.code}))
            return 1
    elif action == "run" and len(sys.argv) > 2:
        env = dict(os.environ)
        env_name = {"deepseek": "DIRECTOR_API_KEY", "fal": "FAL_KEY", "fal-admin": "FAL_ADMIN_KEY", "paddle-sandbox": "PADDLE_API_KEY"}[PROVIDER]
        env[env_name] = validate_secret(keychain())
        if PROVIDER == "paddle-sandbox":
            env["PADDLE_ENVIRONMENT"] = "sandbox"
        return subprocess.run(sys.argv[2:], env=env).returncode
    else:
        raise RuntimeError("Use save, check, or run <command>.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        # Never include upstream bodies, headers or secret values in errors.
        print(f"Credential operation failed: {type(error).__name__}.", file=sys.stderr)
        sys.exit(1)
