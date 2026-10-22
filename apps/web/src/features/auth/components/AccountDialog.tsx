"use client";
export function AccountDialog({
  email,
  close,
  signout,
}: {
  email: string;
  close: () => void;
  signout: () => Promise<void>;
}) {
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Account settings"
      >
        <button
          className="modal-close"
          aria-label="Close"
          onClick={() => close()}
        >
          Close
        </button>
        <h2>Account</h2>
        <p>Signed in as {email}</p>
        <button
          onClick={async () => {
            await signout();
            close();
          }}
        >
          Sign out
        </button>
      </section>
    </div>
  );
}
