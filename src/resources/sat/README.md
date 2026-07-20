# SAT cadena original stylesheets

`cadenaoriginal_4_0.xslt` + `includes/` are SAT's OFFICIAL Anexo 20 transform
(downloaded from www.sat.gob.mx; the phpcfdi/resources-sat-xml mirror carries
identical copies). `cadenaoriginal_4_0.sef.json` is that stylesheet compiled
for saxon-js.

When SAT revises the transform (new complements / rule changes):

1. Re-download `cadenaoriginal_4_0.xslt` and every `xsl:include` it lists into
   `includes/` (keep the hrefs rewritten to `includes/<name>`).
2. Recompile:  `npx xslt3 -xsl:cadenaoriginal_4_0.xslt -export:cadenaoriginal_4_0.sef.json -nogo -relocate:on`
3. Run the seal-service tests — the golden cadena pins will flag semantic changes.
