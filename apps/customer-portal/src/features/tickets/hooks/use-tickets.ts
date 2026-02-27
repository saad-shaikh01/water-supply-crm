import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ticketsApi } from '../api/tickets.api';

export const useTickets = (params: { page?: number; limit?: number; status?: string; type?: string }) =>
  useQuery({
    queryKey: ['portal-tickets', params],
    queryFn: () => ticketsApi.getAll(params).then((r) => r.data),
  });

export const useTicket = (id: string) =>
  useQuery({
    queryKey: ['portal-ticket', id],
    queryFn: () => ticketsApi.getById(id).then((r) => r.data),
    enabled: !!id,
  });

export const useTicketMessages = (id: string, enabled = true) =>
  useQuery({
    queryKey: ['portal-ticket-messages', id],
    queryFn: () => ticketsApi.getMessages(id).then((r) => r.data),
    enabled: !!id && enabled,
  });

export const useCreateTicket = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ticketsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-tickets'] });
      toast.success('Ticket submitted successfully');
    },
    onError: () => {
      toast.error('Failed to submit ticket');
    },
  });
};

export const useCreateTicketMessage = (id: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { message: string; attachments?: Array<Record<string, unknown>> }) =>
      ticketsApi.createMessage(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-ticket-messages', id] });
      queryClient.invalidateQueries({ queryKey: ['portal-tickets'] });
      queryClient.invalidateQueries({ queryKey: ['portal-ticket', id] });
      toast.success('Reply sent');
    },
    onError: () => {
      toast.error('Failed to send reply');
    },
  });
};
