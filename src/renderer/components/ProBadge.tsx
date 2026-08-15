/** Badge « PRO » réutilisable. Petit, doré, cohérent avec la DA Nova. */
export function ProBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`pro-badge${className ? ` ${className}` : ""}`} title="Fonctionnalité Nova Pro">
      ✨ PRO
    </span>
  );
}
