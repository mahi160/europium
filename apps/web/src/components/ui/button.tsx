import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Adapted from shadcn/ui's MIT-licensed button; larger targets for office phones.
const buttonVariants = cva('button inline-flex shrink-0 items-center justify-center gap-2 font-medium disabled:pointer-events-none', {
  variants: {
    variant: { default: 'button-primary', secondary: 'button-secondary', ghost: 'button-ghost', destructive: 'button-destructive' },
  },
  defaultVariants: { variant: 'default' },
});
export function Button({ className, variant, asChild = false, type = 'button', ...props }: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp data-slot="button" type={type} className={twMerge(clsx(buttonVariants({ variant }), className))} {...props} />;
}
