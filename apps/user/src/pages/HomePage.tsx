import { BuildingPicker } from '../components/BuildingPicker';
import { CampusCard } from '../components/CampusCard';
import { LocationCard } from '../components/LocationCard';
import { RoomSearch } from '../components/RoomSearch';
import { errorMessage } from '../lib/api';
import { useActiveBuilding } from '../lib/queries';

export function HomePage() {
  const building = useActiveBuilding();

  return (
    <main className="page">
      <header className="brand-header">
        <img src="/favicon.svg" alt="" width={40} height={40} />
        <div>
          <h1>Chỉ đường trong viện</h1>
          {building.data ? (
            <BuildingPicker building={building.data} />
          ) : (
            <p className="muted">{building.isError ? errorMessage(building.error) : 'Đang tải…'}</p>
          )}
        </div>
      </header>

      {building.data && (
        <>
          <LocationCard building={building.data} />
          <CampusCard building={building.data} />
          <RoomSearch building={building.data} />
        </>
      )}
    </main>
  );
}
