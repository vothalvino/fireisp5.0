---
name: gh-cli-token-scope
description: The git-credential-derived GH_TOKEN lacks read:org — gh pr edit / gh pr view --json commits fail; use gh api ... -X PATCH -F body=@file instead.
metadata:
  type: reference
---

The `GH_TOKEN` obtained via `git credential fill` (per this repo's PR workflow
instructions) has scopes `read:user, repo, user:email, workflow` — it does
**not** have `read:org` / `read:discussion`. `gh pr create` works fine, but
`gh pr edit <n> --body-file <path>` and `gh pr view <n> --json commits` (or
any `--json` field that triggers gh's GraphQL query touching org/team data)
fail with:

```
GraphQL: Your token has not been granted the required scopes to execute this
query. The 'login'/'name'/'slug' field requires ... ['read:org'] ...
```

**How to apply**: to update an existing PR's body/title with this token, use
the REST API directly instead of the `gh pr edit` porcelain command:

```bash
gh api repos/<owner>/<repo>/pulls/<number> -X PATCH -F body=@/path/to/body.md
```

Note `-F` (capital), not `-f` — `-f key=@file` treats `@file` as a **literal
string value** (confirmed by observing `"body":"@/path/to/body.md"` in the
response), while `-F key=@file` triggers gh's special "read from file"
handling and actually substitutes the file's contents. `-q .body` on the
same call is a quick way to verify the update took.

`gh pr view <n> --json url,title,state` (fields that don't need org data)
works fine with this token; it's specifically `commits`/`reviews`/anything
requiring the viewer's org membership that 403s via GraphQL.
