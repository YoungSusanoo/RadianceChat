import { useEffect, useMemo, useState } from "react";
import { MediaController, type MediaControllerState } from "./media";

export function useMediaController() {
  const controller = useMemo(() => new MediaController(), []);
  const [state, setState] = useState<MediaControllerState>(() => controller.snapshot());

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    return () => {
      unsubscribe();
    };
  }, [controller]);

  return { controller, media: state };
}
