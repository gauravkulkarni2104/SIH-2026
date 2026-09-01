"""
Persistent Caching Module for ULPIN Digital Twin API.

Supports:
1. Upstash Redis REST API (via HTTP requests) if UPSTASH_REDIS_REST_URL & UPSTASH_REDIS_REST_TOKEN are set (ideal for Vercel Serverless).
2. Redis TCP connection if REDIS_URL or REDIS_HOST is configured.
3. Persistent file-based & in-memory dictionary fallback with TTL checks for local development.

Keys:
- ulpin:{id}
- geometry:{id}
- nearby:{id}
- 3d:{id}
- overlap:{sorted_ulpin_a}:{sorted_ulpin_b}
- overlap2d:{sorted_ulpin_a}:{sorted_ulpin_b}
"""
from __future__ import annotations
import os
import json
import time
import logging
from typing import Optional, Any

logger = logging.getLogger("ulpin.cache")

CACHE_DIR = os.environ.get(
    "ULPIN_CACHE_DIR",
    os.path.join(os.path.dirname(__file__), "..", ".cache")
)
FILE_CACHE_PATH = os.path.join(CACHE_DIR, "persistent_cache.json")

# In-memory dictionary fallback
_MEMORY_CACHE: dict[str, dict[str, Any]] = {}

# Check env vars for Redis / Upstash
UPSTASH_URL = os.environ.get("UPSTASH_REDIS_REST_URL", "").strip()
UPSTASH_TOKEN = os.environ.get("UPSTASH_REDIS_REST_TOKEN", "").strip()
REDIS_URL = os.environ.get("REDIS_URL", "").strip()

# Try initializing redis client if REDIS_URL is provided
_redis_client = None
if REDIS_URL:
    try:
        import redis
        _redis_client = redis.from_url(REDIS_URL, decode_responses=True)
        logger.info("Connected to Redis via REDIS_URL")
    except Exception as exc:
        logger.warning("Failed to initialize redis client: %s", exc)


def _upstash_get(key: str) -> Optional[dict]:
    if not UPSTASH_URL or not UPSTASH_TOKEN:
        return None
    try:
        import httpx
        url = f"{UPSTASH_URL}/get/{key}"
        headers = {"Authorization": f"Bearer {UPSTASH_TOKEN}"}
        resp = httpx.get(url, headers=headers, timeout=3.0)
        if resp.status_code == 200:
            val_str = resp.json().get("result")
            if val_str:
                return json.loads(val_str)
    except Exception as e:
        logger.warning("Upstash GET error for key %s: %s", key, e)
    return None


def _upstash_set(key: str, value_str: str, ttl_seconds: int = 86400):
    if not UPSTASH_URL or not UPSTASH_TOKEN:
        return
    try:
        import httpx
        url = f"{UPSTASH_URL}/set/{key}?EX={ttl_seconds}"
        headers = {"Authorization": f"Bearer {UPSTASH_TOKEN}"}
        httpx.post(url, headers=headers, content=value_str, timeout=3.0)
    except Exception as e:
        logger.warning("Upstash SET error for key %s: %s", key, e)


def _load_file_cache() -> dict:
    if os.path.exists(FILE_CACHE_PATH):
        try:
            with open(FILE_CACHE_PATH, "r") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def _save_file_cache(data: dict):
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(FILE_CACHE_PATH, "w") as f:
            json.dump(data, f)
    except Exception as e:
        logger.warning("Failed to save persistent file cache: %s", e)


def cache_get(key: str) -> Optional[dict]:
    start_time = time.perf_counter()
    now = time.time()

    # 1. Try Redis TCP client if configured
    if _redis_client:
        try:
            raw = _redis_client.get(key)
            if raw:
                data = json.loads(raw)
                elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
                logger.info("[PERF] Cache hit (Redis TCP) key=%s (%s ms)", key, elapsed_ms)
                if isinstance(data, dict):
                    data["cached"] = True
                return data
        except Exception as e:
            logger.warning("Redis client get error: %s", e)

    # 2. Try Upstash REST API if configured
    if UPSTASH_URL and UPSTASH_TOKEN:
        upstash_data = _upstash_get(key)
        if upstash_data is not None:
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
            logger.info("[PERF] Cache hit (Upstash REST) key=%s (%s ms)", key, elapsed_ms)
            if isinstance(upstash_data, dict):
                upstash_data["cached"] = True
            return upstash_data

    # 3. Try In-Memory dictionary cache
    if key in _MEMORY_CACHE:
        entry = _MEMORY_CACHE[key]
        if now < entry["expires_at"]:
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
            logger.info("[PERF] Cache hit (Memory) key=%s (%s ms)", key, elapsed_ms)
            res = dict(entry["value"]) if isinstance(entry["value"], dict) else entry["value"]
            if isinstance(res, dict):
                res["cached"] = True
                res["cacheAgeSeconds"] = round(now - entry["cached_at"], 1)
            return res
        else:
            del _MEMORY_CACHE[key]

    # 4. Try File-based persistent cache fallback
    file_cache = _load_file_cache()
    if key in file_cache:
        entry = file_cache[key]
        if now < entry.get("expires_at", 0):
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
            logger.info("[PERF] Cache hit (File) key=%s (%s ms)", key, elapsed_ms)
            # Promote to memory cache
            _MEMORY_CACHE[key] = entry
            res = dict(entry["value"]) if isinstance(entry["value"], dict) else entry["value"]
            if isinstance(res, dict):
                res["cached"] = True
                res["cacheAgeSeconds"] = round(now - entry.get("cached_at", now), 1)
            return res
        else:
            del file_cache[key]
            _save_file_cache(file_cache)

    elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
    logger.info("[PERF] Cache miss key=%s (%s ms)", key, elapsed_ms)
    return None


def cache_set(key: str, value: Any, ttl_seconds: int = 86400):
    now = time.time()
    expires_at = now + ttl_seconds
    val_str = json.dumps(value)

    # 1. Redis TCP
    if _redis_client:
        try:
            _redis_client.setex(key, ttl_seconds, val_str)
        except Exception as e:
            logger.warning("Redis client set error: %s", e)

    # 2. Upstash REST
    if UPSTASH_URL and UPSTASH_TOKEN:
        _upstash_set(key, val_str, ttl_seconds)

    # 3. Memory cache
    _MEMORY_CACHE[key] = {
        "value": value,
        "cached_at": now,
        "expires_at": expires_at
    }

    # 4. File cache
    file_cache = _load_file_cache()
    file_cache[key] = {
        "value": value,
        "cached_at": now,
        "expires_at": expires_at
    }
    _save_file_cache(file_cache)


def cache_delete(key: str):
    if _redis_client:
        try:
            _redis_client.delete(key)
        except Exception:
            pass

    _MEMORY_CACHE.pop(key, None)
    file_cache = _load_file_cache()
    if key in file_cache:
        del file_cache[key]
        _save_file_cache(file_cache)
