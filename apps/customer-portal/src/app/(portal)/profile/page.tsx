import { ProfileCard } from '../../../features/profile/components/profile-card';
import { UserCircle } from 'lucide-react';

export default function ProfilePage() {
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
          <UserCircle className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-black tracking-tight">Profile Settings</h1>
          <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest text-[10px]">Your Account & Preferences</p>
        </div>
      </div>

      <ProfileCard />
    </div>
  );
}
