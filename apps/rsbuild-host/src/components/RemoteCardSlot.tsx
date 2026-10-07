import { loadRemote } from "@module-federation/runtime";
import { useEffect, useState, type ComponentType } from "react";

type RemoteModule = {
  default: ComponentType;
};

export function RemoteCardSlot({ fallback, remote }: { fallback: string; remote: string }) {
  const [RemoteCard, setRemoteCard] = useState<ComponentType | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setRemoteCard(null);
    setFailed(false);

    loadRemote<RemoteModule>(remote)
      .then((remoteModule) => {
        if (!active) return;
        if (remoteModule?.default) {
          setRemoteCard(() => remoteModule.default);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [remote]);

  if (failed) return <div className="remote-loading">Remote unavailable</div>;
  if (!RemoteCard) return <div className="remote-loading">{fallback}</div>;
  return <RemoteCard />;
}
