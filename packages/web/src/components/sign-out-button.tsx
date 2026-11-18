// A form POST rather than a link: signing out changes state, and a GET
// could be triggered by any page that embeds an image pointing at it.
export function SignOutButton({
  className = "",
  formClassName = "inline",
  title,
  children = "Sign out",
}: {
  className?: string;
  formClassName?: string;
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <form method="post" action="/auth/logout" className={formClassName}>
      <button type="submit" className={className} title={title}>
        {children}
      </button>
    </form>
  );
}
