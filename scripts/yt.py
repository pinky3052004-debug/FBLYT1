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
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TITLE = "\U0001F30D WORLD CUP FLAG BATTLE LIVE \U0001F534 | Who Will Win Today? \U0001F3C6 #shorts #youtubeshorts #viral"
CATEGORY_ID = "20"  # Gaming


def _read(name):
    return open(os.path.join(HERE, name), encoding="utf-8").read()


def tags():
    return [t.strip() for t in _read("tags.txt").splitlines() if t.strip()]
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
    title, description = TITLE[:100], _read("description.txt")[:5000]
    stream = call("POST", "liveStreams", {"part": "snippet,cdn,contentDetails"}, {
        "snippet": {"title": title},
        "cdn": {"ingestionType": "rtmp", "resolution": "variable", "frameRate": "variable"},
        "contentDetails": {"isReusable": False},
    })
    start = (now + datetime.timedelta(seconds=90)).strftime("%Y-%m-%dT%H:%M:%SZ")
    b = call("POST", "liveBroadcasts", {"part": "snippet,status,contentDetails"}, {
        "snippet": {
            "title": title,
            "description": description,
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
    set_metadata(b["id"], title, description)
    set_thumbnail(b["id"])


def set_metadata(video_id, title, description):
    """Tags and category live on the video resource, not the broadcast."""
    try:
        call("PUT", "videos", {"part": "snippet"}, {
            "id": video_id,
            "snippet": {"title": title, "description": description, "tags": tags(), "categoryId": CATEGORY_ID},
        })
        print("tags/category set")
    except Exception as e:  # never stop the stream because of metadata
        print("metadata failed:", e)


def set_thumbnail(video_id):
    path = os.path.join(ROOT, "thumbnail.jpg")
    if not os.path.exists(path):
        return
    try:
        r = requests.post(
            "https://www.googleapis.com/upload/youtube/v3/thumbnails/set",
            params={"videoId": video_id},
            headers={"Authorization": "Bearer " + token(), "Content-Type": "image/jpeg"},
            data=open(path, "rb").read(), timeout=60,
        )
        print("thumbnail:", r.status_code, "" if r.ok else r.text[:300])
    except Exception as e:
        print("thumbnail failed:", e)


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
