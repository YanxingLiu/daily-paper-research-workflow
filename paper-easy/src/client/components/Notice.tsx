export function Notice({ title, message, kind }: { title: string; message: string; kind?: "error" | "warning" }) {
  return (
    <div className={`notice${kind ? ` ${kind}` : ""}`}>
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}
