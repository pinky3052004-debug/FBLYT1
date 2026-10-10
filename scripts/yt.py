"""YouTube Data API helper: create broadcast, find the live one, finish.

Env: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN
Usage: python scripts/yt.py create | find | complete
Writes live.env (stream key, ingest URLs, broadcast id, chat id) for run_live.sh.
"""
import datetime
import os
import sys
import time

import requests

API = "https://www.googleapis.com/youtube/v3"
_tok = {"t": None, "exp": 0}


def token():
    if _tok["t"] and time.time() < _tok["exp"] - 60:
        return _tok["t"]
    r = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "client_id": os.environ["YT_CLIENT_ID"],
            "client_secret": os.environ["YT_CLIENT_SECRET"],
            "refresh_token": os.environ["YT_REFRESH_TOKEN"],
            "grant_type": "refresh_token",
        },
        timeout=30,
    )
    r.raise_for_status()
    j = r.json()
    _tok["t"] = j["access_token"]
    _tok["exp"] = time.time() + int(j.get("expires_in", 3600))
    return _tok["t"]


def call(method, path, params=None, body=None):
    r = requests.request(
        method, f"{API}/{path}", params=params, json=body,
        headers={"Authorization": "Bearer " + token()}, timeout=30,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"{path} -> {r.status_code}: {r.text[:500]}")
    return r.json() if r.text else {}


def load_env(path="live.env"):
    out = {}
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            if "=" in line:
                k, v = line.rstrip("\n").split("=", 1)
                out[k] = v.strip("'")
    return out


def write_env(**kw):
    with open("live.env", "w", encoding="utf-8") as f:
        for k, v in kw.items():
            f.write(f"{k}='{v}'\n")


def ingest(stream_id):
    info = call("GET", "liveStreams", {"part": "cdn", "id": stream_id})["items"][0]["cdn"]["ingestionInfo"]
    return (
        info["streamName"],
        info["ingestionAddress"],
        info.get("backupIngestionAddress", "rtmp://b.rtmp.youtube.com/live2?backup=1"),
    )


def create():
    now = datetime.datetime.utcnow()
    title = f"\U0001F30D Country Flag Battle LIVE | Guess the winner - {now:%b %d}"
    stream = call("POST", "liveStreams", {"part": "snippet,cdn,contentDetails"}, {
        "snippet": {"title": title},
        "cdn": {"ingestionType": "rtmp", "resolution": "variable", "frameRate": "variable"},
        "contentDetails": {"isReusable": False},
    })
    start = (now + datetime.timedelta(seconds=90)).strftime("%Y-%m-%dT%H:%M:%SZ")
    b = call("POST", "liveBroadcasts", {"part": "snippet,status,contentDetails"}, {
        "snippet": {
            "title": title,
            "description": "Country flags battle inside the ring. Comment who you think will win!",
            "scheduledStartTime": start,
        },
        "status": {"privacyStatus": "public", "selfDeclaredMadeForKids": False},
        "contentDetails": {
            "enableAutoStart": True,
            "enableAutoStop": False,
            "enableDvr": True,
            "recordFromStart": True,
            "latencyPreference": "low",
            "monitorStream": {"enableMonitorStream": False},
        },
    })
    call("POST", "liveBroadcasts/bind", {"id": b["id"], "part": "id,contentDetails", "streamId": stream["id"]})
    key, primary, backup = ingest(stream["id"])
    write_env(BROADCAST_ID=b["id"], CHAT_ID=b["snippet"].get("liveChatId", ""), STREAM_KEY=key, PRIMARY=primary, BACKUP=backup)
    print("broadcast:", b["id"], "https://youtube.com/watch?v=" + b["id"])


def find():
    items = []
    for status in ("active", "upcoming"):
        items = call("GET", "liveBroadcasts", {
            "part": "snippet,contentDetails,status", "broadcastStatus": status, "maxResults": 10,
        }).get("items", [])
        items = [i for i in items if i["contentDetails"].get("boundStreamId")]
        if items:
            break
    if not items:
        raise SystemExit("no active/upcoming broadcast found")
    b = items[0]
    key, primary, backup = ingest(b["contentDetails"]["boundStreamId"])
    write_env(BROADCAST_ID=b["id"], CHAT_ID=b["snippet"].get("liveChatId", ""), STREAM_KEY=key, PRIMARY=primary, BACKUP=backup)
    print("using broadcast:", b["id"])


def complete():
    bid = load_env().get("BROADCAST_ID")
    if bid:
        call("POST", "liveBroadcasts/transition", {"broadcastStatus": "complete", "id": bid, "part": "status"})
        print("broadcast completed")


if __name__ == "__main__":
    {"create": create, "find": find, "complete": complete}[sys.argv[1]]()
