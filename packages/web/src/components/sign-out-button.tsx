// A form POST rather than a link: signing out changes state, and a GET
// could be triggered by any page that embeds an image pointing at it.
export function SignOutButton({ className = "" }: { className?: string }) {
  return (
    <form method="post" action="/auth/logout" className="inline">
      <button type="submit" className={className}>
        Sign out
      </button>
    </form>
  );
}
