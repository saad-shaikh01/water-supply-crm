export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Welcome back!</h1>
        <p className="text-muted-foreground">Here's what's happening with your water supply business today.</p>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Active Customers', value: '128', change: '+4' },
          { label: 'Today\'s Deliveries', value: '45', change: '12 pending' },
          { label: 'Bottles in Hand', value: '1,240', change: '+15' },
          { label: 'Pending Balance', value: 'Rs. 45,000', change: '+Rs. 2,300' },
        ].map((stat) => (
          <div key={stat.label} className="p-6 bg-card border rounded-lg shadow-sm">
            <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-2xl font-bold">{stat.value}</span>
              <span className="text-xs text-green-500 font-medium">{stat.change}</span>
            </div>
          </div>
        ))}
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <div className="col-span-4 p-6 bg-card border rounded-lg shadow-sm h-[300px] flex items-center justify-center text-muted-foreground">
          Delivery Volume Chart (Coming Soon)
        </div>
        <div className="col-span-3 p-6 bg-card border rounded-lg shadow-sm h-[300px] flex items-center justify-center text-muted-foreground">
          Recent Activity (Coming Soon)
        </div>
      </div>
    </div>
  );
}
