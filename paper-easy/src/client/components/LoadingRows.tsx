export function LoadingRows() {
  return (
    <div className="loading-stack" aria-label="Loading papers">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="skeleton-row" key={index}>
          <div />
          <div />
          <div />
        </div>
      ))}
    </div>
  );
}
