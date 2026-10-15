# Chick Explore — standalone 3D voxel demo (internal review only)

Isolated from the game: not in `pnpm-workspace.yaml` (which only covers `apps/*`, `packages/*`), uses npm with its own lockfile, and is not copied by the root Dockerfile.

    npm ci && npm run dev      # local
    npm run build              # -> dist/
    gcloud run deploy chick-explore-demo --source . --region asia-east1 --project silver-greens \
      --allow-unauthenticated --min-instances 0 --max-instances 1 --cpu 1 --memory 128Mi --port 8080

Controls: WASD/arrows move, Space jump, Shift dash (i-frames), J peck, hold K heavy hit, E chest, R respawn, 1/2/3 quality, H help.
