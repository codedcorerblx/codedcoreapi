"use client";
export default function TryButton({ id }: { id: string }) {
  return (
    <button className="btn small primary" type="button" onClick={() => {
      window.dispatchEvent(new CustomEvent("playground:select", { detail: id }));
      document.getElementById("playground")?.scrollIntoView({ behavior: "smooth" });
    }}>Try in playground</button>
  );
}
