# Feijoada do Master — site estatico servido pelo Caddy
FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html /srv/index.html

# O Railway injeta a porta em $PORT; o Caddyfile le essa variavel.
EXPOSE 8080
