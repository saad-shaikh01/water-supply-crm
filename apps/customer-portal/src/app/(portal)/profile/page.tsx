import { ProfileCard } from '../../../features/profile/components/profile-card';

export default function ProfilePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Profile</h1>
        <p className="text-sm text-muted-foreground">Your account information</p>
      </div>

      <ProfileCard />
    </div>
  );
}
