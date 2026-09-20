FROM rqlite/rqlite:10.3.3@sha256:d333ab884b9451aecb12e29fbc2dfbb013d9f582763f288d79dcac5f20bfc312

COPY --chown=rqlite:rqlite --chmod=0555 entrypoint.sh /entrypoint.sh

USER rqlite

ENTRYPOINT ["/entrypoint.sh"]
