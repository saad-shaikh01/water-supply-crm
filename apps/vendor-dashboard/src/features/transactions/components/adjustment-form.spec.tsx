import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdjustmentForm } from './adjustment-form';
import { useAddAdjustment } from '../hooks/use-transactions';

jest.mock('@water-supply-crm/ui', () => {
  const actual = jest.requireActual('@water-supply-crm/ui');
  const React = require('react');
  const SelectContext = React.createContext({
    onValueChange: (_value: string) => undefined,
  });

  return {
    ...actual,
    Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
    SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
    SheetFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Select: ({
      onValueChange,
      children,
    }: {
      onValueChange?: (value: string) => void;
      children: React.ReactNode;
    }) => <SelectContext.Provider value={{ onValueChange }}>{children}</SelectContext.Provider>,
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectValue: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const context = React.useContext(SelectContext);
      return (
        <button type="button" onClick={() => context.onValueChange?.(value)}>
          {children}
        </button>
      );
    },
  };
});

jest.mock('../hooks/use-transactions', () => ({
  useAddAdjustment: jest.fn(),
}));

const mockUseAddAdjustment = useAddAdjustment as jest.MockedFunction<typeof useAddAdjustment>;

describe('AdjustmentForm', () => {
  const addAdjustment = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAddAdjustment.mockReturnValue({
      mutate: addAdjustment,
      isPending: false,
    } as ReturnType<typeof useAddAdjustment>);
  });

  it('requires a reason before saving an adjustment', async () => {
    render(<AdjustmentForm open onOpenChange={jest.fn()} customerId="customer-1" />);

    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '300' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Adjustment' }));

    expect(await screen.findByText('Reason is required')).toBeTruthy();
    expect(addAdjustment).not.toHaveBeenCalled();
  });

  it('submits debit adjustments for the selected customer', async () => {
    const onOpenChange = jest.fn();
    render(<AdjustmentForm open onOpenChange={onOpenChange} customerId="customer-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Debit (deduct from balance)' }));
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '300' },
    });
    fireEvent.change(screen.getByPlaceholderText('Reason for adjustment'), {
      target: { value: 'Deposit correction' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Adjustment' }));

    await waitFor(() =>
      expect(addAdjustment).toHaveBeenCalledWith(
        {
          customerId: 'customer-1',
          data: { amount: 300, type: 'DEBIT', reason: 'Deposit correction' },
        },
        expect.any(Object)
      )
    );

    act(() => {
      const [, options] = addAdjustment.mock.calls[0];
      options.onSuccess();
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
