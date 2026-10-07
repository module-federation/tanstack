import { Component, Suspense, type ReactNode } from "react";

type Props = { children: ReactNode; fallback: string; name: string };

/** Keeps a failed remote from taking down the host route. */
export class RemoteBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn(`[${this.props.name}] remote failed to render`, error);
  }

  render() {
    if (this.state.failed) {
      return <div className="remote-loading">{this.props.name} is unavailable</div>;
    }

    return (
      <Suspense fallback={<div className="remote-loading">{this.props.fallback}</div>}>
        {this.props.children}
      </Suspense>
    );
  }
}
