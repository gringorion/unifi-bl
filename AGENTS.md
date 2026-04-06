# Release Rules

- The version shown by the UI must always come from `package.json`.
- Every code modification must bump `package.json` before finishing the task.
- A simple modification bumps the patch version by `0.0.1`.
- An important modification bumps the minor version by `0.1.0` and resets the patch digit to `0`.
- Every committed version change must also be pushed to `http://192.168.40.219:3000/Nico/unifi-bl.git`.
- `npm run deploy:131` is the default release path: it pushes the current committed branch to `192.168.40.219` and then redeploys the `unifi_bl` Docker service on `192.168.40.131`.
- `npm run deploy:131` must only be used from a clean git worktree where the bumped `package.json` version is already committed.
- `npm run deploy:131:direct` remains available for an emergency redeploy of the current working tree without the git sync.
