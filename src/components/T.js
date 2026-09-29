// Both translations of a short text; CSS shows the active one (globals.css).
export function T({ ru, en }) {
  return (
    <>
      <span data-locale="ru" lang="ru">
        {ru}
      </span>
      <span data-locale="en" lang="en">
        {en}
      </span>
    </>
  );
}
