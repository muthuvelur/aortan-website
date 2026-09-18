# How to update the yearly programme

You don't need any coding knowledge or software installed — everything is
done in the web browser on github.com.

## One-time setup (only needed the first time)

1. Ask Muthu to invite you as a "collaborator" on the
   `muthuvelur/aortan-website` GitHub repository (you'll need a free
   GitHub account — sign up at https://github.com/join if you don't have
   one).
2. Accept the invite email from GitHub.

## Every year: updating the front page programme

1. Go to https://github.com/muthuvelur/aortan-website
2. Click on the file **`index.html`**.
3. Click the pencil icon (✏️) in the top-right of the file view — this
   opens the editor.
4. Scroll down until you see this marker:

   ```
   <!-- PROGRAMME START -->
   ```

5. Between `PROGRAMME START` and `PROGRAMME END`, edit only the text —
   leave every `<...>` tag exactly where it is. For example, change:
   - `Pongal 2027` → `Pongal 2028`
   - the date, venue (if it changes), programme list, and ticket prices
6. When you're done, scroll to the bottom of the page.
7. Under "Commit changes", leave "Commit directly to the `master` branch"
   selected, and click the green **Commit changes** button.
8. That's it! The live site at aortan.org.uk updates automatically
   within about a minute — no further steps needed.

## If something looks broken after publishing

Go back into the same file, click the pencil icon again, and either fix
the tag you accidentally deleted, or click "..." → "Revert this file" /
ask Muthu to roll it back to the previous version (every change is saved
in the file's History tab, so nothing is ever truly lost).
