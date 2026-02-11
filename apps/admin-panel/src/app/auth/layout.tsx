export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-primary">WaterCRM</h1>
        <p className="text-muted-foreground mt-2">Enterprise Water Supply Management</p>
      </div>
      {children}
    </div>
  );
}
