'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Input, Label, Card, CardContent } from '@water-supply-crm/ui';
import { loginSchema, type LoginInput } from '../schemas';
import { useLogin } from '../hooks/use-auth';
import Link from 'next/link';
import { Droplets, ArrowRight, Loader2, Eye, EyeOff } from 'lucide-react';
import { motion } from 'framer-motion';

export function LoginForm() {
  const { mutate: login, isPending } = useLogin();
  const [showPassword, setShowPassword] = useState(false);

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
      className="w-full max-w-sm space-y-6"
    >
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 text-primary mb-2">
          <Droplets className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-black tracking-tight">Customer Portal</h1>
        <p className="text-sm text-muted-foreground">Manage your water supply account</p>
      </div>

      <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-2xl">
        <CardContent className="p-6">
          <form onSubmit={handleSubmit((d) => login(d))} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="identifier" className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Email or Phone Number</Label>
              <Input
                id="identifier"
                type="text"
                placeholder="name@example.com or 03001234567"
                className="h-12 rounded-2xl bg-accent/30 border-border/50 focus:border-primary/50 transition-all px-4 font-medium"
                {...register('identifier')}
              />
              {errors.identifier && (
                <p className="text-[10px] font-bold text-destructive ml-1">{errors.identifier.message}</p>
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
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  className="h-12 rounded-2xl bg-accent/30 border-border/50 focus:border-primary/50 transition-all px-4 pr-10"
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
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
              Don't have an account?{' '}
              <Link href="/auth/activate" className="text-primary font-bold hover:underline">
                Activate your account
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
