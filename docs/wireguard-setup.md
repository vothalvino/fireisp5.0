# WireGuard activation & host setup

FireISP is the **hub**: MikroTik NAS routers and technician / support / admin laptops
dial in over WireGuard, and FireISP routes between them so an operator can reach every
device behind a NAS for monitoring and troubleshooting — without exposing the router's
management plane to the internet.

A fresh installation ships **disabled**. While disabled the app
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

> **Requirements.** A Linux host that can run kernel WireGuard:
> - **full virtualization** (KVM / bare-metal) — *not* an OpenVZ/LXC VPS, which can't load kernel modules;
> - the **`wireguard` kernel module loaded** (an unprivileged container can't load it itself):
>   ```bash
>   sudo apt install -y linux-modules-extra-$(uname -r)   # Ubuntu generic kernels ship wireguard.ko here
>   sudo modprobe wireguard
>   echo wireguard | sudo tee /etc/modules-load.d/wireguard.conf   # persist across reboots
>   lsmod | grep wireguard                                # verify
>   ```
>   Without it, interface creation fails with `RTNETLINK answers: Operation not permitted`.

---

## 1. Activation — web GUI

The production web/API app is always **non-root** and has no added Linux
capabilities. The stack includes a separate read-only WireGuard helper whose only
capability is `NET_ADMIN`; it receives no database, Redis, JWT, or encryption
secrets and accepts only named WireGuard operations over a private Unix socket.

Sign in as the installation operator, open **Settings → Organization Config →
Installation-wide settings**, edit `wireguard_server_enabled`, and select
**Enabled**. The helper creates the interfaces, firewall, and peers immediately;
no shell, Compose override, or container restart is required. Select **Disabled**
to remove the runtime interfaces and FireISP-owned firewall table while retaining
the server keys for a future re-enable.

The settings row displays the public endpoint and both UDP ports. Fresh installs
generate two distinct random high ports and keep the values only in private
`.env.prod`; upgrades retain existing ports so issued peer configs keep working.
Open the displayed ports in the cloud firewall/security group (and host firewall,
if active). A port is not a secret—WireGuard's keys provide security—but random
ports reduce routine scan noise. `WG_ENDPOINT_HOST` may override `DOMAIN`.

During the first upgrade to this release, FireISP imports the old deployment
choice once: an explicitly disabled hub stays disabled, while an existing
default-on/enabled hub stays enabled. From then on the database-backed GUI switch
is authoritative.

On boot the app **self-provisions, idempotently** (no `wg-quick` / `/etc/wireguard`
steps required):

- generates the two server keypairs **if absent**, persisting them `0600` to the
  `wg_keys` volume at `WG_KEY_DIR=/etc/wireguard` (keys never enter git or the image);
- creates `wg-fireisp` (10.255.0.1) + `wg-clients` (10.99.0.1), binds each private key
  + listen port, and brings the interfaces up;
- enables `net.ipv4.ip_forward`;
- installs the base nftables ruleset.

A redeploy re-runs all of this and re-converges — existing keys are reused and existing
interfaces are left in place. With the GUI setting disabled, privileged operations
stop and runtime interfaces/firewall state are removed (configs/snippets/QRs remain).

> **Security model.** Only `wireguard-helper` runs as uid 0 with `NET_ADMIN`;
> every other capability is dropped, privilege escalation is disabled, and its
> root filesystem is read-only. The public app, dev, test, and e2e retain the
> image's non-root `fireisp` user.

> **Where do the interfaces live?** In the **app container's own network namespace**
> (the compose does *not* use host networking, which would break the bridge service-DNS
> MySQL/Redis/Nginx rely on). Live status is visible in the WireGuard GUI; for
> shell-level diagnostics, inspect the isolated `wireguard-helper`. Device access
> is entirely through the tunnels, so host networking is unnecessary.

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
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec wireguard-helper wg show                  # optional shell-level diagnostic
```
- Create a peer in **My Tunnels** → `… exec wireguard-helper wg show wg-clients`
  lists it, and `… exec wireguard-helper nft list table inet fireisp_wg` shows
  the `forward` + `wg_user_fwd` chains.
- Add a MikroTik **NAS** → `GET /nas/:id/wg` flips to `state: active`,
  `server_peer_synced: 1`; `… exec wireguard-helper wg show wg-fireisp` lists
  the NAS peer.
- If the host lacks the `wireguard` module or the GUI setting is disabled, `GET /nas/:id/wg`
  stays `null` and peer creation still returns a config but `server_peer_synced=0` — the
  app degraded to config-issuance only (nothing errors).

---

## Notes & guardrails

- **Host ports:** the UDP mappings have no listener while the GUI setting is
  disabled. If you self-manage WireGuard on the host (§2), select different ports through
  `WG_LISTEN_PORT`/`WG_CLIENT_LISTEN_PORT`.
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
