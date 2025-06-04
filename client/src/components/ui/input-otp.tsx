import * as React from "react"
import { OTPInput, Slot, type OTPInputProps } from "input-otp" // Ensure input-otp is installed and its types are present

import { cn } from "@/lib/utils"

const InputOTP = React.forwardRef<
  React.ElementRef<typeof OTPInput>,
  React.ComponentPropsWithoutRef<typeof OTPInput>
>(({ className, containerClassName, ...props }, ref) => (
  <OTPInput
    ref={ref}
    containerClassName={cn(
      "flex items-center gap-2 has-[:disabled]:opacity-50",
      containerClassName
    )}
    className={cn("disabled:cursor-not-allowed", className)}
    {...props}
  />
))
InputOTP.displayName = "InputOTP"

const InputOTPGroup = React.forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex items-center", className)} {...props} />
))
InputOTPGroup.displayName = "InputOTPGroup"

const InputOTPSlot = React.forwardRef<
  React.ElementRef<typeof Slot>,
  React.ComponentPropsWithoutRef<typeof Slot> & { index: number }
>(({ index, className, ...props }, ref) => {
  const inputOTPContext = React.useContext(OTPInput.Context); // Explicitly type context if possible, or use `any` as fallback
  const { char, hasFocused } = inputOTPContext.slots[index];

  return (
    <Slot
      ref={ref}
      className={cn(
        "relative flex h-9 w-9 items-center justify-center border-y border-r border-input text-sm shadow-sm transition-all first:rounded-l-md first:border-l last:rounded-r-md",
        hasFocused && "z-10 ring-1 ring-ring",
        className
      )}
      {...props}
    >
      {char}
      {hasFocused && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="h-4 w-px animate-caret-blink bg-foreground" />
        </span>
      )}
    </Slot>
  );
});
InputOTPSlot.displayName = "InputOTPSlot"

const InputOTPAcceptableText = React.forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
))
InputOTPAcceptableText.displayName = "InputOTPAcceptableText"

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPAcceptableText }
