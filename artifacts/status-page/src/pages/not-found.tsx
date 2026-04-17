import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex gap-2">
          <AlertCircle className="h-8 w-8 text-red-500" />
          <h1 className="text-2xl font-bold text-gray-900">404 Page Not Found</h1>
        </div>

        <p className="mt-4 text-sm text-gray-600">
          Did you forget to add the page to the router?
        </p>
      </div>
    </div>
  );
}
