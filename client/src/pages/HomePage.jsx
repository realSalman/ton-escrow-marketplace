export function HomePage({ userProfile }) {
  return (
    <section>
      <header className="mt-2 flex justify-between items-start mb-4 flex-wrap gap-3">
        <div>
          <p className="uppercase text-xs tracking-wider mb-1 m-0">Signed in as</p>
          <h1 className="m-0 text-2xl leading-tight">{userProfile?.fullName || `${userProfile?.firstName || ''} ${userProfile?.lastName || ''}`.trim() || userProfile?.username || 'Guest'}</h1>
        </div>
        <div className="flex flex-col items-end text-right sm:items-start sm:text-left">
        </div>
      </header>
    </section>
  );
}

