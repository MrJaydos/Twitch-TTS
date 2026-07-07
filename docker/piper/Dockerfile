FROM python:3.11-slim

# espeak-ng provides the phonemizer backend Piper relies on.
RUN apt-get update \
  && apt-get install -y --no-install-recommends espeak-ng \
  && rm -rf /var/lib/apt/lists/*

# piper-tts with the optional HTTP server extras.
RUN pip install --no-cache-dir "piper-tts[http]"

WORKDIR /data

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 5000

# Voices are downloaded into /data (mount a volume there to persist).
ENTRYPOINT ["/entrypoint.sh"]
