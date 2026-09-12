ARG RQLITE_VERSION=10.3.2
FROM rqlite/rqlite:${RQLITE_VERSION}

USER root
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
