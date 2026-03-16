import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CustomerForm } from './customer-form';
import { useCreateCustomer, useUpdateCustomer } from '../hooks/use-customers';
import { useRoutes } from '../../routes/hooks/use-routes';
import { useAllVans } from '../../vans/hooks/use-vans';

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
    SheetDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
    SheetFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Select: ({
      onValueChange,
      children,
    }: {
      onValueChange?: (value: string) => void;
      children: React.ReactNode;
    }) => <SelectContext.Provider value={{ onValueChange }}>{children}</SelectContext.Provider>,
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
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

jest.mock('../hooks/use-customers', () => ({
  useCreateCustomer: jest.fn(),
  useUpdateCustomer: jest.fn(),
}));

jest.mock('../../routes/hooks/use-routes', () => ({
  useRoutes: jest.fn(),
}));

jest.mock('../../vans/hooks/use-vans', () => ({
  useAllVans: jest.fn(),
}));

const mockUseCreateCustomer = useCreateCustomer as jest.MockedFunction<typeof useCreateCustomer>;
const mockUseUpdateCustomer = useUpdateCustomer as jest.MockedFunction<typeof useUpdateCustomer>;
const mockUseRoutes = useRoutes as jest.MockedFunction<typeof useRoutes>;
const mockUseAllVans = useAllVans as jest.MockedFunction<typeof useAllVans>;

const routeId = '11111111-1111-4111-8111-111111111111';
const vanId = '22222222-2222-4222-8222-222222222222';

describe('CustomerForm', () => {
  const create = jest.fn();
  const update = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCreateCustomer.mockReturnValue({
      mutate: create,
      isPending: false,
    } as ReturnType<typeof useCreateCustomer>);
    mockUseUpdateCustomer.mockReturnValue({
      mutate: update,
      isPending: false,
    } as ReturnType<typeof useUpdateCustomer>);
    mockUseRoutes.mockReturnValue({
      data: {
        data: [{ id: routeId, name: 'Central Route' }],
      },
    } as ReturnType<typeof useRoutes>);
    mockUseAllVans.mockReturnValue({
      data: {
        data: [{ id: vanId, plateNumber: 'LEA-123', isActive: true }],
      },
    } as ReturnType<typeof useAllVans>);
  });

  it('creates a customer with parsed coordinates and delivery schedule', async () => {
    const onOpenChange = jest.fn();
    render(<CustomerForm open onOpenChange={onOpenChange} />);

    fireEvent.change(screen.getByPlaceholderText('Ahmed Ali'), {
      target: { value: 'Ahmed Ali' },
    });
    fireEvent.change(screen.getByPlaceholderText('0300-1234567'), {
      target: { value: '03001234567' },
    });
    fireEvent.change(screen.getByPlaceholderText('House No / Building, Street, Area'), {
      target: { value: 'Street 1, Lahore' },
    });
    fireEvent.change(screen.getByPlaceholderText('Paste Google Maps share URL here...'), {
      target: { value: 'https://maps.google.com/?q=31.52040,74.35870' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Central Route' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mon' }));
    fireEvent.change(screen.getByPlaceholderText('Seq'), {
      target: { value: '4' },
    });

    expect(await screen.findByText(/Coordinates detected:/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Onboard Customer' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Ahmed Ali',
          phoneNumber: '03001234567',
          address: 'Street 1, Lahore',
          googleMapsUrl: 'https://maps.google.com/?q=31.52040,74.35870',
          latitude: 31.5204,
          longitude: 74.3587,
          routeId,
          paymentType: 'CASH',
          deliverySchedule: [{ dayOfWeek: 1, vanId, routeSequence: 4 }],
        }),
        expect.any(Object)
      )
    );

    act(() => {
      const [, options] = create.mock.calls[0];
      options.onSuccess();
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('hydrates edit mode and updates the selected customer', async () => {
    const onOpenChange = jest.fn();

    render(
      <CustomerForm
        open
        onOpenChange={onOpenChange}
        customer={{
          id: 'customer-1',
          name: 'Existing Customer',
          customerCode: 'CUS-001',
          phoneNumber: '03001234567',
          address: 'Street 1, Lahore',
          googleMapsUrl: 'https://maps.google.com/?q=31.52040,74.35870',
          latitude: 31.5204,
          longitude: 74.3587,
          route: { id: routeId },
          paymentType: 'MONTHLY',
          deliverySchedules: [{ dayOfWeek: 1, vanId, routeSequence: 2 }],
        }}
      />
    );

    expect(screen.getByDisplayValue('Existing Customer')).toBeTruthy();

    fireEvent.change(screen.getByDisplayValue('Existing Customer'), {
      target: { value: 'Updated Customer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update Customer' }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        {
          id: 'customer-1',
          data: expect.objectContaining({
            name: 'Updated Customer',
            routeId,
            paymentType: 'MONTHLY',
            deliverySchedule: [{ dayOfWeek: 1, vanId, routeSequence: 2 }],
          }),
        },
        expect.any(Object)
      )
    );

    act(() => {
      const [, options] = update.mock.calls[0];
      options.onSuccess();
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
