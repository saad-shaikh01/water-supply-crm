'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Input, Label, Card, CardContent, CardHeader, CardTitle, CardDescription } from '@water-supply-crm/ui';
import { loginSchema, type LoginInput } from '../schemas';
import { useLogin } from '../hooks/use-auth';
import Link from 'next/link';
import { Droplets, ArrowRight, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

export function LoginForm() {
  const { mutate: login, isPending } = useLogin();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="w-full max-w-md"
    >
      <Card className="border-none shadow-2xl rounded-[2.5rem] overflow-hidden bg-background/80 backdrop-blur-xl border border-white/10">
        <div className="bg-primary p-10 text-white relative overflow-hidden">
          <div className="relative z-10">
            <div className="h-12 w-12 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center mb-6 border border-white/10">
              <Droplets className="h-7 w-7 text-white" />
            </div>
            <h1 className="text-3xl font-black tracking-tight">Customer Portal</h1>
            <p className="text-white/70 font-bold uppercase tracking-widest text-[10px] mt-2">Manage your water supply account</p>
          </div>
          {/* Decoration */}
          <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/10 rounded-full blur-3xl" />
        </div>

        <CardContent className="p-10 pt-8">
          <form onSubmit={handleSubmit((d) => login(d))} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                className="h-12 rounded-2xl bg-accent/30 border-border/50 focus:border-primary/50 transition-all px-4 font-medium"
                {...register('email')}
              />
              {errors.email && (
                <p className="text-[10px] font-bold text-destructive ml-1">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between ml-1">
                <Label htmlFor="password" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Password</Label>
                <Link
                  href="/auth/forgot-password"
                  className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline"
                >
                  Forgot?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                className="h-12 rounded-2xl bg-accent/30 border-border/50 focus:border-primary/50 transition-all px-4"
                {...register('password')}
              />
              {errors.password && (
                <p className="text-[10px] font-bold text-destructive ml-1">{errors.password.message}</p>
              )}
            </div>

            <Button 
              type="submit" 
              className="w-full h-14 rounded-2xl font-black text-lg shadow-xl shadow-primary/20 active:scale-95 transition-all mt-4" 
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <span className="flex items-center gap-2">
                  Sign In <ArrowRight className="h-5 w-5" />
                </span>
              )}
            </Button>
          </form>

          <div className="mt-8 text-center">
            <p className="text-xs text-muted-foreground font-medium">
              Don't have an account? <span className="text-primary font-bold">Contact your vendor</span>
            </p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
