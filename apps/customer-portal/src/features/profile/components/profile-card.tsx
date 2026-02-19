'use client';

import { Card, CardContent, CardHeader, CardTitle, Skeleton, Separator, Badge, Button } from '@water-supply-crm/ui';
import { User, Mail, Phone, MapPin, Package, Wallet, Calendar, ShieldCheck, Clock, ExternalLink } from 'lucide-react';
import { useProfile } from '../hooks/use-profile';
import { cn } from '@water-supply-crm/ui';
import { motion } from 'framer-motion';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ProfileCard() {
  const { data: profile, isLoading } = useProfile();

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-32 bg-muted/30 rounded-[2rem] w-full" />
        <div className="h-[400px] bg-muted/20 rounded-[2rem] w-full" />
      </div>
    );
  }

  if (!profile) return null;

  const infoFields = [
    { icon: Mail, label: 'Email Address', value: profile.email },
    { icon: Phone, label: 'Phone Number', value: profile.phoneNumber ?? '—' },
    { icon: MapPin, label: 'Delivery Address', value: profile.address ?? '—' },
  ];

  return (
    <div className="space-y-6">
      {/* Profile Header Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Card className="rounded-[2rem] border-none bg-gradient-to-br from-zinc-900 to-zinc-800 dark:from-zinc-900 dark:to-black text-white overflow-hidden shadow-2xl">
          <CardContent className="p-8 relative">
            <div className="flex flex-col sm:flex-row items-center gap-6 relative z-10">
              <div className="h-20 w-20 rounded-3xl bg-primary/20 backdrop-blur-xl border border-white/10 flex items-center justify-center text-3xl font-black shadow-inner">
                {profile.name.charAt(0)}
              </div>
              <div className="text-center sm:text-left flex-1">
                <div className="flex items-center justify-center sm:justify-start gap-2">
                  <h2 className="text-2xl font-black tracking-tight">{profile.name}</h2>
                  <ShieldCheck className="h-5 w-5 text-blue-400 fill-blue-400/20" />
                </div>
                <p className="text-zinc-400 text-sm font-bold uppercase tracking-widest mt-1">Verified Customer</p>
                <div className="mt-4 flex flex-wrap justify-center sm:justify-start gap-2">
                  <Badge className="bg-white/10 hover:bg-white/20 text-white border-white/10 font-mono text-[10px] tracking-tighter uppercase px-2 py-0">
                    {profile.id?.slice(0, 8).toUpperCase()}
                  </Badge>
                  <Badge className="bg-primary/20 text-primary-foreground border-primary/20 font-bold text-[10px] tracking-widest uppercase px-2 py-0">
                    {profile.route?.name || 'Unassigned'}
                  </Badge>
                </div>
              </div>
            </div>
            
            {/* Decoration */}
            <div className="absolute top-0 right-0 p-8 opacity-10">
              <User className="h-24 w-24" />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Info Card */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="rounded-[2rem] border-border/50 bg-card/30 backdrop-blur-sm overflow-hidden h-full">
            <CardHeader className="border-b bg-muted/20 px-6 py-4">
              <CardTitle className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <Clock className="h-3 w-3" /> Account Information
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="space-y-6">
                {infoFields.map((field, i) => (
                  <div key={i} className="flex items-start gap-4">
                    <div className="h-10 w-10 rounded-2xl bg-accent/50 border border-border/50 flex items-center justify-center shrink-0">
                      <field.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{field.label}</p>
                      <p className="text-sm font-bold">{field.value}</p>
                    </div>
                  </div>
                ))}
              </div>
              <Separator className="my-6 bg-border/50" />
              <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-muted-foreground italic">
                <span>Member Since</span>
                <span>{new Date(profile.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Schedule & Balance Card */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          className="space-y-6"
        >
          <Card className="rounded-[2rem] border-border/50 bg-card/30 backdrop-blur-sm overflow-hidden">
            <CardHeader className="border-b bg-muted/20 px-6 py-4">
              <CardTitle className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <Calendar className="h-3 w-3" /> Delivery Schedule
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="flex flex-wrap gap-2">
                {(profile as any).deliveryDays?.length > 0 ? (
                  (profile as any).deliveryDays.map((d: number) => (
                    <Badge key={d} className="bg-primary/10 text-primary border-primary/20 font-black text-[10px] px-3 py-1">
                      {DAYS[d]}
                    </Badge>
                  ))
                ) : (
                  <p className="text-sm font-bold text-muted-foreground italic">No schedule set</p>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground mt-4 font-bold leading-relaxed">
                Contact support if you wish to change your delivery days.
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-border/50 bg-card/30 backdrop-blur-sm overflow-hidden">
            <CardHeader className="border-b bg-muted/20 px-6 py-4">
              <CardTitle className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <Wallet className="h-3 w-3" /> Quick Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Current Balance</p>
                  <p className="text-2xl font-black font-mono mt-1">₨ {profile.financialBalance?.toLocaleString() ?? 0}</p>
                </div>
                <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                  <Package className="h-6 w-6" />
                </div>
              </div>
              <Button variant="outline" className="w-full mt-6 rounded-xl font-bold gap-2 text-xs border-dashed">
                <ExternalLink className="h-3 w-3" /> Download Statement
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
