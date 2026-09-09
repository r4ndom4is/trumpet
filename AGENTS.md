# Publishing

- When the user requests publication of `r4ndom4is/trumpet`, use the already-authorized GitHub owner account **r4ndom4is**. Do not ask again for permission to select this account.
- An injected `GH_TOKEN` can select the read-only `rmais_microsoft` account instead. If necessary, remove that override only in the publishing command's process, select the saved `r4ndom4is` account with `gh auth switch`, and use `gh auth git-credential` as the command-scoped Git credential helper. Never print or copy tokens.
- Confirm the selected account and repository push permission before publishing. A denial for the wrong account is not a reason to stop before checking the authorized owner account.
- GitHub Pages publishes `main` at `https://r4ndom4is.github.io/trumpet/`. Push only the intended release files, without force, and confirm the deployed release before saying it is live.
- Account authorization does not authorize unsolicited releases: publish only when the user requests it.
