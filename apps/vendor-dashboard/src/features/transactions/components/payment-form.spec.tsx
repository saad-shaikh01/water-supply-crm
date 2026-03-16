import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PaymentForm } from './payment-form';
import { useAddPayment } from '../hooks/use-transactions';

jest.mock('@water-supply-crm/ui', () => {
  const actual = jest.requireActual('@water-supply-crm/ui');
  return {
    ...actual,
    Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
    SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
    SheetDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
    SheetFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

jest.mock('../hooks/use-transactions', () => ({
  useAddPayment: jest.fn(),
}));

const mockUseAddPayment = useAddPayment as jest.MockedFunction<typeof useAddPayment>;

describe('PaymentForm', () => {
  const addPayment = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAddPayment.mockReturnValue({
      mutate: addPayment,
      isPending: false,
    } as ReturnType<typeof useAddPayment>);
  });

  it('does not submit non-positive payment amounts', async () => {
    render(<PaymentForm open onOpenChange={jest.fn()} customerId="customer-1" />);

    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }));

    await waitFor(() => expect(addPayment).not.toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Record Payment' })).toBeTruthy();
  });

  it('submits a manual payment against the selected customer', async () => {
    const onOpenChange = jest.fn();
    render(<PaymentForm open onOpenChange={onOpenChange} customerId="customer-1" />);

    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '2500' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. Received via JazzCash, Cash on Delivery'), {
      target: { value: 'Cash on delivery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }));

    await waitFor(() =>
      expect(addPayment).toHaveBeenCalledWith(
        {
          customerId: 'customer-1',
          data: { amount: 2500, description: 'Cash on delivery' },
        },
        expect.any(Object)
      )
    );

    act(() => {
      const [, options] = addPayment.mock.calls[0];
      options.onSuccess();
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
