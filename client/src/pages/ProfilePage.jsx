export function ProfilePage({ profile }) {
  return (
    <>
      <section className=" border-2 p-4 rounded-2xl flex flex-col gap-3">
        <header className="flex justify-between items-start mb-1 flex-wrap gap-3">
          <div>
            <h2 className="m-0 text-2xl leading-tight">{profile?.fullName || `${profile?.firstName || ''} ${profile?.lastName || ''}`.trim() || profile?.username || 'Guest'}</h2>
            {profile?.username && (
              <p className="uppercase text-xs tracking-wider mb-1 m-0 mt-1 opacity-70">
                @{profile.username}
              </p>
            )}
          </div>
        </header>
      </section>
    </>
  );
}

