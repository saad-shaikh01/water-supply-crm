export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-primary">WaterCRM</h1>
          <p className="text-sm text-muted-foreground mt-1">Customer Portal</p>
        </div>
        {children}
      </div>
    </div>
  );
}
