import Link from 'next/link';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@water-supply-crm/ui';

export default function SignupPage() {
  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Create Account</CardTitle>
        <CardDescription>Vendor registration is handled by your administrator</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground text-center py-4">
          To create a vendor account, please contact your system administrator or use the admin panel.
        </p>
      </CardContent>
      <CardFooter className="flex justify-center">
        <Link href="/auth/login" className="text-sm text-primary hover:underline">
          Back to Login
        </Link>
      </CardFooter>
    </Card>
  );
}
