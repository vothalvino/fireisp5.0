# WireGuard activation & host setup

FireISP is the **hub**: MikroTik NAS routers and technician / support / admin laptops
dial in over WireGuard, and FireISP routes between them so an operator can reach every
device behind a NAS for monitoring and troubleshooting — without exposing the router's
management plane to the internet.

The automation ships **disabled** (`WG_SERVER_ENABLED=false`). While disabled the app
still *generates* configs / paste-once snippets / QR codes, but it does **not** bring up
kernel tunnels (`GET /nas/:id/wg` stays `null`, peers report `server_peer_synced=0`).

Two kernel WireGuard interfaces are **auto-provisioned and managed by the app**:

| Interface    | Peers                         | Subnet (`env`)                 | Server IP    | UDP port (`env`)            |
|--------------|-------------------------------|--------------------------------|--------------|-----------------------------|
| `wg-fireisp` | MikroTik NAS routers          | `WG_SERVER_SUBNET` 10.255.0.0/16 | `10.255.0.1` | `WG_LISTEN_PORT` 51820      |
| `wg-clients` | admin / technician / support  | `WG_CLIENT_SUBNET` 10.99.0.0/16  | `10.99.0.1`  | `WG_CLIENT_LISTEN_PORT` 51821 |

Datapath: `user client → wg-clients → (IP-forward + nftables per-user scope + MASQUERADE) → wg-fireisp → NAS tunnel → device`.

The IP allocator reserves `.1` on each subnet for the server interface and assigns
peers from `.2` upward, so the addresses above never collide with a provisioned peer.

> **Requirements.** A Linux host whose kernel has the `wireguard` module (Ubuntu ≥ 5.6
> ships it) — bare-metal or a VPS, **not** most managed PaaS.

---

## 1. Activation — on by default, just redeploy

In **production the hub is ON by default**: `docker-compose.prod.yml` carries everything
it needs (`NET_ADMIN`, IPv4 forwarding, the published UDP ports, the `wg_keys` volume),
and the dial-in endpoint **auto-derives from `DOMAIN`** — the public host you already set
for TLS. So a normal redeploy activates it: no extra variables, no separate compose file.

```bash
# Redeploy the way you always do, e.g.:
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

# Then open the two UDP ports in the cloud firewall / security group
# (host ufw too, if active): 51820/udp and 51821/udp
```

To **opt out**, set `WG_SERVER_ENABLED=false` in `.env.prod` and redeploy. To advertise a
public host different from `DOMAIN`, set `WG_ENDPOINT_HOST`.

On boot the app **self-provisions, idempotently** (no `wg-quick` / `/etc/wireguard`
steps required):

- generates the two server keypairs **if absent**, persisting them `0600` to the
  `wg_keys` volume at `WG_KEY_DIR=/etc/wireguard` (keys never enter git or the image);
- creates `wg-fireisp` (10.255.0.1) + `wg-clients` (10.99.0.1), binds each private key
  + listen port, and brings the interfaces up;
- enables `net.ipv4.ip_forward`;
- installs the base nftables ruleset.

A redeploy re-runs all of this and re-converges — existing keys are reused, existing
interfaces are left in place. To turn the hub back **off**, set `WG_SERVER_ENABLED=false`
and redeploy; the app stops shelling out (configs/snippets/QRs are still issued).

> **Upgrading a host that already enabled WireGuard under an older, root-based build?**
> The `wg_keys` volume may hold root-owned keys the non-root user can't read, so the hub
> would silently fail to come up. Fix it once before the first redeploy:
> `docker compose -f docker-compose.prod.yml run --rm --user 0:0 app chown -R fireisp:fireisp /etc/wireguard`
> (or `docker volume rm <project>_wg_keys` to regenerate fresh server keys, if no peers
> are pinned to the old key). **Fresh installs need nothing.**

> **Security model.** The hub runs as the non-root `fireisp` user: the image grants
> `CAP_NET_ADMIN` to the `wg`/`ip`/`nft` binaries via file capabilities, and the prod
> compose puts `NET_ADMIN` in the container's bounding set (`cap_add`). No `root` /
> `user: "0:0"` is needed. When `WG_SERVER_ENABLED=false` the capability is never
> exercised (the bootstrap no-ops), so a disabled deploy's posture is unchanged.

> **Where do the interfaces live?** In the **app container's own network namespace**
> (the compose does *not* use host networking, which would break the bridge service-DNS
> MySQL/Redis/Nginx rely on). Inspect them with `docker compose -f docker-compose.prod.yml
> exec app wg show`. Device access is entirely through the tunnels, so host networking is
> unnecessary.

---

## 2. Self-managed alternative (pin an external key)

If you prefer to own the interfaces yourself (e.g. systemd `wg-quick@` on the host),
run them outside the app and set `WG_SERVER_PUBLIC_KEY` / `WG_CLIENT_SERVER_PUBLIC_KEY`
to the matching public keys. In that mode the app manages peers on interfaces it did not
create. This is optional — §1 is the recommended path. If a pinned public key does not
match the private key the interface is actually bound to, the app logs a warning and
advertises the on-disk key (issued configs always reflect the key the server holds).

```bash
# Per interface, on the host:
sudo sh -c 'umask 077; wg genkey | tee /etc/wireguard/wg-fireisp.key | wg pubkey > /etc/wireguard/wg-fireisp.pub'
# …create /etc/wireguard/wg-fireisp.conf (Address 10.255.0.1/16, ListenPort 51820, PrivateKey …)
# …repeat for wg-clients (10.99.0.1/16, 51821) and `systemctl enable --now wg-quick@…`.
```

---

## 3. Verify

```bash
# Interfaces are in the app container's netns
docker compose -f docker-compose.prod.yml exec app wg show          # both interfaces, no peers yet
```
- Create a peer in **My Tunnels** → `… exec app wg show wg-clients` lists it, and
  `… exec app nft list table inet fireisp_wg` shows the `forward` + `wg_user_fwd` chains.
- Add a MikroTik **NAS** → `GET /nas/:id/wg` flips to `state: active`,
  `server_peer_synced: 1`; `… exec app wg show wg-fireisp` lists the NAS peer.
- If the host lacks the `wireguard` module or `WG_SERVER_ENABLED=false`, `GET /nas/:id/wg`
  stays `null` and peer creation still returns a config but `server_peer_synced=0` — the
  app degraded to config-issuance only (nothing errors).

---

## Notes & guardrails

- **Reserved host ports:** the prod stack publishes UDP `51820`/`51821` on the host
  whenever it's up — even with `WG_SERVER_ENABLED=false` (nothing listens until enabled).
  Don't run another host service on those ports; if you self-manage WireGuard on the host
  (§2), put it on different ports via `WG_LISTEN_PORT`/`WG_CLIENT_LISTEN_PORT` so the two
  don't collide.
- **Keys persist, never in git:** the server private keys live only in the `wg_keys`
  named volume. Back that volume up; losing it regenerates new server identities (peers
  would need re-issued configs).
- **Winbox is never touched.** The RouterOS side of the automation only writes
  `/interface/wireguard`, `/ip/address`, peers, and routes — never `/ip/service` or
  `/ip/firewall`.
- **Subnets** `10.255.0.0/16` and `10.99.0.0/16` must not overlap any device LAN you
  route through a NAS. Change them via the `WG_*_SUBNET` env vars (the server stays on `.1`).
- **Custom ports:** the published UDP port and the app's bind port both derive from
  `WG_LISTEN_PORT` / `WG_CLIENT_LISTEN_PORT`, so to change a port set it in the
  environment compose reads (pass `--env-file .env.prod`) and they stay in lock-step.
- **Per-user scope is firewall-enforced**, not config-trusted: the authoritative ACL is
  the nftables per-user FORWARD chain keyed on the client's `/32`, not the `AllowedIPs`
  in the downloaded `.conf`.
