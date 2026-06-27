# WireGuard activation & host setup

FireISP's WireGuard automation ships **disabled** (`WG_SERVER_ENABLED=false`). While
disabled, the app still *generates* configs / paste-once snippets / QR codes, but it
does **not** bring up kernel tunnels (`GET /nas/:id/wg` stays `null`, peers report
`server_peer_synced=0`). This guide turns it on.

Two kernel WireGuard interfaces live on the FireISP **host** and are managed by the app:

| Interface    | Peers                         | Subnet (`env`)                 | Server IP    | UDP port (`env`)            |
|--------------|-------------------------------|--------------------------------|--------------|-----------------------------|
| `wg-fireisp` | MikroTik NAS routers          | `WG_SERVER_SUBNET` 10.255.0.0/16 | `10.255.0.1` | `WG_LISTEN_PORT` 51820      |
| `wg-clients` | admin / technician / support  | `WG_CLIENT_SUBNET` 10.99.0.0/16  | `10.99.0.1`  | `WG_CLIENT_LISTEN_PORT` 51821 |

Datapath: `user client → wg-clients → (host IP-forward + nftables per-user scope + MASQUERADE) → wg-fireisp → NAS tunnel → device`.

The IP allocator reserves `.1` on each subnet for the server interface and assigns
peers from `.2` upward, so the addresses above never collide with a provisioned peer.

> **Requirements.** The FireISP host must be able to own kernel WireGuard interfaces
> (Ubuntu VPS / bare-metal — **not** most managed PaaS). FireISP runs in Docker here,
> so the container needs `NET_ADMIN` + host networking (§2).

---

## 1. Host setup (Ubuntu)

Run on the host (not in the container). WireGuard interfaces are brought up by the
host so they survive container restarts; the container manages their peers.

```bash
# 1a. Packages + IP forwarding
sudo apt-get update && sudo apt-get install -y wireguard-tools nftables
echo 'net.ipv4.ip_forward=1' | sudo tee /etc/sysctl.d/99-fireisp-wg.conf
sudo sysctl --system

# 1b. Server keypairs (one per interface)
sudo sh -c 'umask 077; wg genkey | tee /etc/wireguard/wg-fireisp.key | wg pubkey > /etc/wireguard/wg-fireisp.pub'
sudo sh -c 'umask 077; wg genkey | tee /etc/wireguard/wg-clients.key | wg pubkey > /etc/wireguard/wg-clients.pub'
```

Create the two interface configs (no `[Peer]` blocks — FireISP adds peers dynamically):

```ini
# /etc/wireguard/wg-fireisp.conf   (NAS peers)
[Interface]
Address    = 10.255.0.1/16
ListenPort = 51820
PrivateKey = <contents of /etc/wireguard/wg-fireisp.key>
```

```ini
# /etc/wireguard/wg-clients.conf   (user peers)
[Interface]
Address    = 10.99.0.1/16
ListenPort = 51821
PrivateKey = <contents of /etc/wireguard/wg-clients.key>
```

```bash
# 1c. Bring up + enable on boot
sudo systemctl enable --now wg-quick@wg-fireisp wg-quick@wg-clients
sudo wg show          # both interfaces up, no peers yet

# 1d. Open the two UDP ports (host firewall AND the cloud security group)
sudo ufw allow 51820/udp && sudo ufw allow 51821/udp
```

---

## 2. Container access (Docker)

The runtime image now bundles `wg`, `ip`, and `nft`. To let FireISP manage the host's
interfaces, the container must share the host network namespace and hold `NET_ADMIN`:

```yaml
# your FireISP service in docker-compose (prod)
services:
  api:                       # <- your service name
    network_mode: host       # see & manage the host's wg-fireisp / wg-clients
    cap_add: [NET_ADMIN]
    user: "0:0"              # NET_ADMIN must be in the EFFECTIVE set; root is simplest.
    environment:
      WG_SERVER_ENABLED: "true"
      WG_ENDPOINT_HOST: "demo.opentrk.com.mx"   # public host NAS + clients dial
      WG_LISTEN_PORT: "51820"
      WG_CLIENT_LISTEN_PORT: "51821"
      WG_SERVER_SUBNET: "10.255.0.0/16"
      WG_CLIENT_SUBNET: "10.99.0.0/16"
      WG_SERVER_PUBLIC_KEY: "<contents of wg-fireisp.pub>"
      WG_CLIENT_SERVER_PUBLIC_KEY: "<contents of wg-clients.pub>"
```

Notes:
- **`network_mode: host`** ignores `ports:` mappings — the app listens directly on the
  host (3000, etc.). Make sure this matches your nginx / reverse-proxy setup.
- **`user: "0:0"`** is the simplest way to give the process `NET_ADMIN` effectively.
  Hardened alternative (keep the non-root `fireisp` user): in a derived image run
  `setcap cap_net_admin+ep /usr/bin/wg /usr/sbin/ip /usr/sbin/nft` and keep
  `cap_add: [NET_ADMIN]`.
- Rebuild from the updated `Dockerfile` and restart so the image includes `wg`/`ip`/`nft`.

---

## 3. Verify

```bash
# On the host
sudo wg show                              # both interfaces present
```
- Create a peer in **My Tunnels** → `sudo wg show wg-clients` lists it, and
  `sudo nft list table inet fireisp_wg` shows the `forward` + `wg_user_fwd` chains.
- Add a MikroTik **NAS** → `GET /nas/:id/wg` flips to `state: active`,
  `server_peer_synced: 1`; `sudo wg show wg-fireisp` lists the NAS peer.
- If caps/host-net are missing or `WG_SERVER_ENABLED=false`, `GET /nas/:id/wg` stays
  `null` and peer creation still returns a config but `server_peer_synced=0` — the
  app degraded to config-issuance only (nothing errors).

---

## Notes & guardrails

- **Disable:** set `WG_SERVER_ENABLED=false` and restart — the app stops shelling out;
  configs/snippets/QRs are still issued.
- **Winbox is never touched.** The RouterOS side of the automation only writes
  `/interface/wireguard`, `/ip/address`, peers, and routes — never `/ip/service` or
  `/ip/firewall`.
- **Subnets** `10.255.0.0/16` and `10.99.0.0/16` must not overlap any device LAN you
  route through a NAS. To change them, update the `WG_*_SUBNET` env vars **and** the
  `Address` lines in the two interface configs (keep the server on `.1`).
- **Per-user scope is firewall-enforced**, not config-trusted: the authoritative ACL is
  the nftables per-user FORWARD chain keyed on the client's `/32`, not the `AllowedIPs`
  in the downloaded `.conf`.
