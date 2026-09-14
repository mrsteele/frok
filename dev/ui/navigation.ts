// Settings reads query parameters to select a service. The gallery has no app router.
export function useSearchParams() {
  return new URLSearchParams(window.location.search);
}
