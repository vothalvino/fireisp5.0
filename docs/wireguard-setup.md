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
> ships it) — bare-metal or a VPS, **not** most managed PaaS. FireISP runs in Docker
> here; the container just needs `NET_ADMIN` (granted by the overlay in §1).

---

## 1. Activation (Docker — the reproducible path)

Activation rides a normal **merge → redeploy**: deploy the production compose with the
WireGuard overlay layered on top. The overlay is strictly additive — it only adds
capabilities/ports/env/volume to the `app` service and leaves DB / Redis / Nginx
untouched.

```bash
# 1a. In .env.prod, enable the hub and set the public endpoint
#     (the host/IP that NAS routers and laptops will dial):
#       WG_SERVER_ENABLED=true
#       WG_ENDPOINT_HOST=demo.opentrk.com.mx

# 1b. Deploy with the overlay (always sanity-check the merge first)
docker compose -f docker-compose.prod.yml -f docker-compose.wireguard.yml \
  --env-file .env.prod config            # confirm the merged config is valid
docker compose -f docker-compose.prod.yml -f docker-compose.wireguard.yml \
  --env-file .env.prod up -d

# 1c. Open the two UDP ports in the cloud firewall / security group
#     (host ufw too, if active): 51820/udp and 51821/udp
```

On boot the app **self-provisions, idempotently** (no `wg-quick` / `/etc/wireguard`
steps required):

- generates the two server keypairs **if absent**, persisting them `0600` to the
  `wg_keys` volume at `WG_KEY_DIR=/etc/wireguard` (keys never enter git or the image);
- creates `wg-fireisp` (10.255.0.1) + `wg-clients` (10.99.0.1), binds each private key
  + listen port, and brings the interfaces up;
- enables `net.ipv4.ip_forward`;
- installs the base nftables ruleset.

A redeploy re-runs all of this and re-converges — existing keys are reused, existing
interfaces are left in place.

> **Where do the interfaces live?** In the **app container's own network namespace**
> (the overlay does *not* use host networking, which would break the bridge service-DNS
> the rest of the stack relies on). Inspect them with `docker compose exec app wg show`.
> Device access is entirely through the tunnels, so host networking is unnecessary.

The overlay grants `NET_ADMIN` and runs the app as `user: "0:0"` (root is the simplest
way to hold `NET_ADMIN` effectively). Hardened alternative: keep the non-root `fireisp`
user and, in a derived image, `setcap cap_net_admin+ep /usr/bin/wg /usr/sbin/ip /usr/sbin/nft`.

---

## 2. Self-managed alternative (no overlay)

If you prefer to own the interfaces yourself (e.g. systemd `wg-quick@` on the host),
you can run them outside the app and set `WG_SERVER_PUBLIC_KEY` /
`WG_CLIENT_SERVER_PUBLIC_KEY` to the matching public keys. In that mode the app manages
peers on interfaces it did not create. This is optional — the §1 overlay is the
recommended, reproducible path.

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
docker compose exec app wg show          # both interfaces present, no peers yet
```
- Create a peer in **My Tunnels** → `docker compose exec app wg show wg-clients` lists
  it, and `docker compose exec app nft list table inet fireisp_wg` shows the `forward` +
  `wg_user_fwd` chains.
- Add a MikroTik **NAS** → `GET /nas/:id/wg` flips to `state: active`,
  `server_peer_synced: 1`; `docker compose exec app wg show wg-fireisp` lists the NAS peer.
- If caps are missing or `WG_SERVER_ENABLED=false`, `GET /nas/:id/wg` stays `null` and
  peer creation still returns a config but `server_peer_synced=0` — the app degraded to
  config-issuance only (nothing errors).

---

## Notes & guardrails

- **Disable:** redeploy without the overlay, or set `WG_SERVER_ENABLED=false` and
  restart — the app stops shelling out; configs/snippets/QRs are still issued.
- **Keys persist, never in git:** the server private keys live only in the `wg_keys`
  named volume. Back that volume up; losing it regenerates new server identities (peers
  would need re-issued configs).
- **Winbox is never touched.** The RouterOS side of the automation only writes
  `/interface/wireguard`, `/ip/address`, peers, and routes — never `/ip/service` or
  `/ip/firewall`.
- **Subnets** `10.255.0.0/16` and `10.99.0.0/16` must not overlap any device LAN you
  route through a NAS. Change them via the `WG_*_SUBNET` env vars (the server stays on `.1`).
- **Per-user scope is firewall-enforced**, not config-trusted: the authoritative ACL is
  the nftables per-user FORWARD chain keyed on the client's `/32`, not the `AllowedIPs`
  in the downloaded `.conf`.
