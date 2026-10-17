// Mock for dompurify — passthrough sanitizer for e2e tests
function DOMPurify() {
  return {
    sanitize: (html: string) => html,
  };
}
export default DOMPurify;
