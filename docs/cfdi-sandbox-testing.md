# CFDI 4.0 sandbox testing (SW Sapien & Finkok)

How to test CFDI stamping/cancellation against a PAC **sandbox** before going
live. This is developer/self-hoster guidance; the regulatory reference lives in
[compliance-mexico.md](compliance-mexico.md).

FireISP seals CFDI XML locally with the organization's CSD and stamps through a
PAC (SW Sapien and/or Finkok, with automatic failover). Everything below has been
verified end-to-end against **both** PACs' sandboxes: invoice (Ingreso) stamp,
invoice cancel, and payment complement (REP / Complemento de Pago 2.0) stamp.

## 1. Environment: sandbox vs production

The org's active fiscal environment is a single switch on
**PAC Providers → Fiscal environment** (stored on
`organization_mx_profiles.pac_environment`). It decides which `pac_providers`
rows are used for stamping and cancellation:

- Sandbox and production are **separate PAC rows** (unique per
  `org + provider + environment`) because their credentials **differ**
  (Finkok username/password, SW token are not the same between environments).
- Only rows whose `environment` matches the switch are used — lowest
  `priority` first, the rest as failover backups. Rows in the other environment
  stay dormant.
- Switching to `production` is refused unless an active production PAC exists.

> ⚠️ **A PAC sandbox accepts more than production does.** In particular Finkok's
> sandbox will process test-only structures that a production plan would reject
> based on your contracted timbrado tier. Never assume "green in sandbox" ⇒
> "green in production" for anything except the CFDI content itself.

## 2. Test CSD

Use SAT's **public test certificates** (`Certificados_Pruebas`, the AC UAT /
"pruebas" issuer). The repo ships the fixture pair under
`tests/fixtures/csd/EKU9003173C9.*` (passphrase `12345678a`). A test CSD is
refused against a **production** PAC (`CSD_TEST_IN_PRODUCTION`) — that guard is
intentional; a real install must upload the organization's real CSD.

`EKU9003173C9` (ESCUELA KEMPER URGATE) is the SAT test **emisor**.

## 3. Receptor RFCs — the #1 sandbox gotcha

CFDI40147 ("el RFC del receptor debe estar en la lista de RFC inscritos… LCO")
is a **test-data** error, not a PAC limitation. The receptor check runs against
the PAC's own copy of SAT's taxpayer list (L_RFC), and **each PAC seeds a
different set** of valid test receptors:

- **SW Sapien sandbox** accepts SAT's public test receptor RFCs, e.g.
  `MISC491214B86`, `CACX7605101P8`, `XOJI740919U48`.
- **Finkok demo** does **not** accept those. It publishes its **own** list of
  receptor test RFCs (below). Do **not** use Finkok's *emisor* test RFCs
  (`EKU9003173C9`, `MISC491214B86`, `IIA040805DZ4`, `IVD920810GU2`,
  `XIQB891116QE4`) in the **Receptor** node — they only pass emisor-side checks
  and throw CFDI40147/40143 as a receptor.

Finkok demo receptor RFCs (source:
<https://wiki.finkok.com/home/certificados> — "Lista de RFC's para utilizar como
receptores en CFDI 4.0"). Use the **exact** `Nombre` and `DomicilioFiscalReceptor`:

| RFC | Nombre | C.P. | Tipo |
|---|---|---|---|
| `AABF800614HI0` | FELIX MANUEL ANDRADE BALLADO | 86400 | física |
| `MASO451221PM4` | MARIA OLIVIA MARTINEZ SAGAZ | 80290 | física |
| `CUSC850516316` | CESAR OSBALDO CRUZ SOLORZANO | 45638 | física |
| `CTE950627K46` | COMERCIALIZADORA TEODORIKAS | 57740 | moral |
| `ICV060329BY0` | INMOBILIARIA CVA | 33826 | moral |
| `ABC970528UHA` | ARENA BLANCA SCL DE CV | 80290 | moral |
| `AMO8905171T1` | ALBERCAS MONTAÑO | 22000 | moral |
| `GCA000415UX7` | GRUPO DE CONSTRUCCION ARQUITECTONICA NACIONAL | 11830 | moral |
| `HHN0507087N4` | HIDRO HORTICOLA DEL NOROESTE | 82198 | moral |

`AABF800614HI0` is Finkok's own example receptor and is verified working here.

**Público en general** (`XAXX010101000`) is a separate valid path on both PACs,
but it requires an `<cfdi:InformacionGlobal>` node and
`DomicilioFiscalReceptor == LugarExpedicion`; it is **not** the only way to test
normal receptors.

## 4. UsoCFDI must match the receptor's régimen

`UsoCFDI` is not free-choice: SAT's `c_UsoCFDI` catalog restricts which values
are valid for each receptor `RegimenFiscalReceptor` and person type. Sending a
mismatch fails with *"La clave del campo UsoCFDI debe corresponder con el tipo de
persona… y el régimen correspondiente"*. Examples seen in testing:

- Régimen `616` ("Sin obligaciones fiscales", e.g. `AABF800614HI0`) → `UsoCFDI="S01"`.
- Régimen `612` ("Personas Físicas con Actividades Empresariales", e.g.
  `MISC491214B86`) → `UsoCFDI="G03"` (among others).

In the app this is driven by the client's stored fiscal profile, so a correctly
configured client passes automatically — it only bites hand-built test data.
Payment complements (REP) always use `UsoCFDI="CP01"`, independent of régimen.

## 5. Payment complements (REP / Complemento de Pago 2.0)

A REP is `TipoDeComprobante="P"` with a Pagos 2.0 complement whose
`DoctoRelacionado` references a prior **PPD** invoice UUID. To test: stamp a PPD
invoice (`MetodoPago="PPD"`, `FormaPago="99"`), then stamp a REP referencing its
UUID. Verified on both SW and Finkok sandboxes.

## 6. Error hint

When a sandbox stamp fails with a receptor-data error (the CFDI40143–40149
family or the UsoCFDI/régimen message), FireISP appends a pointer back to this
document (`receptorDataHint` in `src/services/cfdiService.js`). In production
that hint is suppressed — there the error means the receptor's real fiscal data
is wrong, and the raw SAT message is what the operator needs.
